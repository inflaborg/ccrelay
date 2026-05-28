/**
 * Leader election for multi-instance CCRelay
 * Coordinates which instance runs the HTTP server
 *
 * State Machine:
 * - idle: Initial state, not started
 * - electing: Currently running election
 * - leader: Won election, but server not started yet
 * - leader_active: Leader with server running
 * - follower: Following an active leader
 * - waiting: Waiting for a new leader to appear
 */

import { ServerLock, getServerLock } from "./serverLock";
import { probeCcrelayHttp, setLeaderHttpProbeBearer } from "./httpLeaderProbe";
import { ScopedLogger } from "../utils/logger";
import {
  ElectionResult,
  ElectionState,
  InstanceRole,
  RoleChangeInfo,
  type ServerLockInfo,
} from "../types";

// Timeout for probing existing server
const PROBE_TIMEOUT_MS = 500; // 500ms - reduced from 2s for faster startup

// Maximum failed leadership attempts before giving up
const MAX_LEADERSHIP_FAILURES = 3;

// Heartbeat interval for leader (how often to update lock)
const LEADER_HEARTBEAT_INTERVAL_MS = 3_000; // 3 seconds

// Follower probe intervals (exponential backoff)
const PROBE_INITIAL_INTERVAL_MS = 5_000; // Initial 5 seconds
const PROBE_MAX_INTERVAL_MS = 30_000; // Max 30 seconds
const PROBE_BACKOFF_FACTOR = 1.5; // Backoff factor

// Election timeout
const ELECTION_TIMEOUT_MS = 10_000; // 10 seconds

// Wait for leader ready timeout
const LEADER_READY_TIMEOUT_MS = 10_000; // 10 seconds
const LEADER_READY_INITIAL_PROBE_MS = 500; // Initial probe interval
const LEADER_READY_MAX_PROBE_MS = 2_000; // Max probe interval

// Callback type for role changes (extended with state and error)
type RoleChangeCallback = (info: RoleChangeInfo) => void;

/**
 * Leader election manager
 */
export class LeaderElection {
  private instanceId: string;
  private port: number;
  private host: string;
  private serverLock: ServerLock;
  private log = new ScopedLogger("LeaderElection");

  // State machine
  private state: ElectionState = "idle";
  private role: InstanceRole = "follower"; // Default, will be set during election
  private leaderUrl: string | null = null;
  private isRunning: boolean = false;
  private failedLeadershipAttempts: number = 0;
  private hasPortConflict: boolean = false;

  // Election lock to prevent concurrent elections
  private electionInProgress: boolean = false;

  // Exponential backoff state for follower probing
  private currentProbeInterval: number = PROBE_INITIAL_INTERVAL_MS;
  private consecutiveProbeFailures: number = 0;

  // Timers
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private electionTimer: NodeJS.Timeout | null = null;

  // Callbacks
  private onRoleChangeCallbacks: Set<RoleChangeCallback> = new Set();

  private readonly getApiBearerToken: () => string;

  constructor(port: number, host: string, getApiBearerToken: () => string) {
    this.instanceId = this.generateInstanceId();
    this.port = port;
    this.host = host;
    this.getApiBearerToken = getApiBearerToken;
    this.serverLock = getServerLock();
    setLeaderHttpProbeBearer(getApiBearerToken);
  }

  /**
   * Generate a unique instance ID
   */
  private generateInstanceId(): string {
    // Use process.pid + random component for uniqueness
    const pid = process.pid;
    const random = Math.random().toString(36).substring(2, 11);
    return `${pid}-${random}`;
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Probe if a CCRelay server is already running on the specified port
   * by making an HTTP request to /ccrelay/status
   */
  private async probeExistingServer(): Promise<boolean> {
    const probeStart = Date.now();
    const ok = await probeCcrelayHttp(this.host, this.port, PROBE_TIMEOUT_MS);
    const duration = Date.now() - probeStart;
    if (ok) {
      this.log.info(
        `[LeaderElection] Found existing CCRelay server at ${this.host}:${this.port} in ${duration}ms`
      );
    } else if (duration > 100) {
      this.log.debug(`[LeaderElection] Probe failed in ${duration}ms`);
    }
    return ok;
  }

  private async isLeaderHttpServing(leader: ServerLockInfo): Promise<boolean> {
    return probeCcrelayHttp(leader.host, leader.port, PROBE_TIMEOUT_MS);
  }

  /**
   * Become follower for a lock-recorded leader only when its HTTP server responds.
   */
  private async tryBecomeFollowerForLeader(leader: ServerLockInfo): Promise<ElectionResult | null> {
    const leaderHttpUp = await this.isLeaderHttpServing(leader);
    if (!leaderHttpUp) {
      this.log.warn(
        `[LeaderElection] Leader ${leader.instanceId} is registered in the lock but HTTP is not serving`
      );
      return null;
    }

    this.log.info(
      `[LeaderElection] Existing leader found: ${leader.instanceId} at ${leader.host}:${leader.port}`
    );
    this.role = "follower";
    this.setState("follower");
    this.leaderUrl = `http://${leader.host}:${leader.port}`;
    this.resetProbeInterval();
    return {
      isLeader: false,
      leaderUrl: this.leaderUrl,
      existingLeader: leader,
    };
  }

  /**
   * Set the election state and log the transition
   */
  private setState(newState: ElectionState): void {
    const oldState = this.state;
    this.state = newState;
    this.log.info(`[LeaderElection] State transition: ${oldState} -> ${newState}`);
  }

  /**
   * Get current election state
   */
  getState(): ElectionState {
    return this.state;
  }

  /**
   * Wait for leader server to be ready after election
   */
  async waitForLeaderReady(
    leaderUrl: string,
    maxWaitMs: number = LEADER_READY_TIMEOUT_MS
  ): Promise<boolean> {
    const startTime = Date.now();
    let probeInterval = LEADER_READY_INITIAL_PROBE_MS;

    this.log.info(`[LeaderElection] Waiting for leader at ${leaderUrl} to be ready`);

    while (Date.now() - startTime < maxWaitMs) {
      if (await this.probeExistingServer()) {
        this.log.info(`[LeaderElection] Leader at ${leaderUrl} is ready`);
        return true;
      }
      await this.sleep(probeInterval);
      probeInterval = Math.min(probeInterval * 1.5, LEADER_READY_MAX_PROBE_MS);
    }

    this.log.warn(`[LeaderElection] Leader at ${leaderUrl} not ready after ${maxWaitMs}ms`);
    return false;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Elect leader with timeout protection
   */
  async electLeaderWithTimeout(): Promise<ElectionResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Election timeout")), ELECTION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([this.electLeader(), timeoutPromise]);
    } catch (err) {
      this.log.error(`[LeaderElection] Election timed out after ${ELECTION_TIMEOUT_MS}ms`);
      throw err;
    }
  }

  async electLeader(): Promise<ElectionResult> {
    const electionStart = Date.now();

    // Prevent concurrent elections
    if (this.electionInProgress) {
      this.log.warn(`[LeaderElection] Election already in progress, skipping`);
      return {
        isLeader: false,
        leaderUrl: this.leaderUrl ?? undefined,
      };
    }

    this.electionInProgress = true;
    this.setState("electing");

    try {
      this.log.info(
        `[LeaderElection] ===== ELECTION START ===== for instance ${this.instanceId} at ${new Date().toISOString()}`
      );

      // Check if we've exceeded max leadership failures (port conflict with external process)
      if (this.hasPortConflict) {
        this.log.warn(
          `[LeaderElection] Port conflict detected previously, not attempting leadership`
        );
        this.role = "follower";
        this.setState("waiting");
        this.leaderUrl = null;
        return {
          isLeader: false,
          leaderUrl: undefined,
        };
      }

      // Initialize server lock database first (needed to check heartbeat)
      await this.serverLock.initialize();

      // Check if there's a valid leader with fresh heartbeat
      const existingLeader = await this.serverLock.getCurrentLeader();

      // Probe if a CCRelay server is already running on the port
      const serverAlreadyRunning = await this.probeExistingServer();

      if (serverAlreadyRunning) {
        // Server is responding - but is its heartbeat still valid?
        if (existingLeader) {
          // Server running AND heartbeat is fresh - become follower
          this.log.info(
            `[LeaderElection] Server already running on port ${this.port} with valid heartbeat, becoming follower`
          );
          this.role = "follower";
          this.setState("follower");
          this.leaderUrl = `http://${this.host}:${this.port}`;
          // Reset failure counter and probe interval since we found a valid leader
          this.failedLeadershipAttempts = 0;
          this.resetProbeInterval();
          return {
            isLeader: false,
            leaderUrl: this.leaderUrl,
            existingLeader,
          };
        } else {
          // Server is running but heartbeat is STALE - the old leader is shutting down
          // Wait a bit for the server to fully stop, then try to become leader
          this.log.info(
            `[LeaderElection] Server responding on port ${this.port} but heartbeat is stale, waiting for shutdown`
          );
          await this.sleep(1000); // Wait 1 second for graceful shutdown

          // Probe again to see if server has stopped
          const serverStillRunning = await this.probeExistingServer();
          if (serverStillRunning) {
            // Server still running - wait a bit more and become follower temporarily
            this.log.info(
              `[LeaderElection] Server still running after wait, becoming temporary follower`
            );
            this.role = "follower";
            this.setState("waiting");
            this.leaderUrl = `http://${this.host}:${this.port}`;
            return {
              isLeader: false,
              leaderUrl: this.leaderUrl,
            };
          }
          // Server has stopped, continue to try to become leader
          this.log.info(`[LeaderElection] Server has stopped, proceeding to become leader`);
        }
      }

      // Clean up any stale locks first
      await this.serverLock.cleanupStaleLocks();

      // Re-check if there's a leader now (may have changed during our probing)
      const currentLeader = await this.serverLock.getCurrentLeader();

      if (currentLeader) {
        const followerResult = await this.tryBecomeFollowerForLeader(currentLeader);
        if (followerResult) {
          return followerResult;
        }
        await this.serverLock.cleanupStaleLocks();
      }

      // No valid leader, try to become the leader
      this.log.info(`[LeaderElection] No valid leader found, attempting to become leader`);
      const acquired = await this.serverLock.tryAclock(this.instanceId, this.port, this.host);

      if (acquired) {
        const ipcOk = await this.serverLock.ensureIpcServer();
        if (!ipcOk) {
          this.log.warn(
            `[LeaderElection] Acquired leadership lock but failed to bind IPC coordination socket`
          );
        } else {
          await this.serverLock.invalidateInheritedLeaderIfHttpDown(this.instanceId);
        }
        this.log.info(`[LeaderElection] Instance ${this.instanceId} became leader`);
        this.role = "leader";
        this.setState("leader"); // Server not started yet
        this.leaderUrl = `http://${this.host}:${this.port}`;
        return {
          isLeader: true,
          leaderUrl: this.leaderUrl,
        };
      }

      // Lock was acquired by another instance between our check and attempt
      this.log.info(`[LeaderElection] Failed to acquire lock, another instance became leader`);
      const newLeader = await this.serverLock.getCurrentLeader();

      if (newLeader) {
        const followerResult = await this.tryBecomeFollowerForLeader(newLeader);
        if (followerResult) {
          return followerResult;
        }
      }

      // Shouldn't reach here, but handle gracefully - assume follower
      this.log.warn(`[LeaderElection] Election resulted in unclear state, defaulting to follower`);
      this.role = "follower";
      this.setState("waiting");
      return {
        isLeader: false,
        leaderUrl: undefined,
      };
    } finally {
      const electionDuration = Date.now() - electionStart;
      this.log.info(
        `[LeaderElection] ===== ELECTION COMPLETE in ${electionDuration}ms ===== (role: ${this.role})`
      );
      this.electionInProgress = false;
    }
  }

  /**
   * Start the election process (heartbeat + monitoring)
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.log.info(`[LeaderElection] Started election for instance ${this.instanceId}`);

    if (this.role === "follower") {
      this.startMonitoring();
    }
  }

  /**
   * Stop the election process
   */
  async stop(): Promise<void> {
    this.log.info(`[LeaderElection] Stopping election for instance ${this.instanceId}`);

    this.isRunning = false;

    // Stop timers
    this.stopHeartbeat();
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    // Release lock if we're the leader
    if (this.role === "leader" || this.state === "leader" || this.state === "leader_active") {
      await this.serverLock.release(this.instanceId);
      this.log.info(`[LeaderElection] Released leadership lock`);
    }

    // Drop IPC listener so another process can coordinate (followers no-op if not listening)
    await this.serverLock.close();

    this.role = "follower"; // Reset to follower on stop
    this.setState("idle");
    this.leaderUrl = null;
  }

  /**
   * Reset probe interval to initial value
   */
  private resetProbeInterval(): void {
    this.currentProbeInterval = PROBE_INITIAL_INTERVAL_MS;
    this.consecutiveProbeFailures = 0;
  }

  /**
   * Increase probe interval with exponential backoff
   */
  private increaseProbeInterval(): void {
    this.consecutiveProbeFailures++;
    this.currentProbeInterval = Math.min(
      this.currentProbeInterval * PROBE_BACKOFF_FACTOR,
      PROBE_MAX_INTERVAL_MS
    );
    this.log.debug(
      `[LeaderElection] Probe interval increased to ${this.currentProbeInterval}ms (failures: ${this.consecutiveProbeFailures})`
    );
  }

  /**
   * Start heartbeat as leader (only while HTTP is actively serving)
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.log.info(`[LeaderElection] Starting heartbeat as leader_active`);
    this.heartbeatTimer = setInterval(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- setInterval doesn't await callbacks
      async () => {
        if (this.state !== "leader_active") {
          this.stopHeartbeat();
          return;
        }

        const selfHttpUp = await probeCcrelayHttp(this.host, this.port, PROBE_TIMEOUT_MS);
        if (!selfHttpUp) {
          this.log.warn(
            `[LeaderElection] Self HTTP not serving while leader_active, self-evicting instance ${this.instanceId}`
          );
          await this.selfEvict();
          return;
        }

        await this.serverLock.updateHeartbeat(this.instanceId, this.port, this.host);
      },
      LEADER_HEARTBEAT_INTERVAL_MS
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Leader detected it no longer serves HTTP — release coordination and become follower.
   */
  private async selfEvict(): Promise<void> {
    this.stopHeartbeat();
    await this.serverLock.release(this.instanceId);
    await this.serverLock.close();

    this.role = "follower";
    this.setState("waiting");
    this.leaderUrl = null;

    if (this.isRunning) {
      this.startMonitoringAsFollower();
    }
    this.notifyRoleChange();
  }

  /**
   * Port bind failed (EADDRINUSE). If another instance serves HTTP, demote to its follower.
   */
  async handlePortConflict(): Promise<{ becameFollower: boolean; leaderUrl?: string }> {
    const serverUp = await this.probeExistingServer();
    if (serverUp) {
      this.log.info(
        `[LeaderElection] Port ${this.port} held by active server, demoting to follower`
      );
      this.stopHeartbeat();
      await this.serverLock.release(this.instanceId);
      await this.serverLock.close();

      this.role = "follower";
      this.setState("follower");
      this.leaderUrl = `http://${this.host}:${this.port}`;
      this.failedLeadershipAttempts = 0;
      this.resetProbeInterval();

      if (this.isRunning) {
        this.stopMonitoring();
        this.startMonitoring();
      }

      this.notifyRoleChange();
      return { becameFollower: true, leaderUrl: this.leaderUrl };
    }

    this.log.info(
      `[LeaderElection] Port conflict but no server responding, cleaning stale coordination state`
    );
    await this.serverLock.cleanupStaleLocks();
    await this.serverLock.invalidateInheritedLeaderIfHttpDown(this.instanceId);
    return { becameFollower: false };
  }

  /**
   * Release lock and IPC socket when demoting to follower (keep election monitoring).
   */
  async releaseCoordinationOnDemotion(): Promise<void> {
    this.stopHeartbeat();
    if (this.role === "leader" || this.state === "leader" || this.state === "leader_active") {
      await this.serverLock.release(this.instanceId);
    }
    await this.serverLock.close();
  }

  /**
   * Force-stop coordination without waiting for HTTP shutdown (deactivate timeout path).
   */
  async forceStop(): Promise<void> {
    this.isRunning = false;
    this.stopHeartbeat();
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    if (this.role === "leader" || this.state === "leader" || this.state === "leader_active") {
      await this.serverLock.release(this.instanceId);
    }
    await this.serverLock.close();

    this.role = "follower";
    this.setState("idle");
    this.leaderUrl = null;
  }

  /**
   * Start monitoring as follower with exponential backoff
   */
  private startMonitoring(): void {
    this.log.info(
      `[LeaderElection] Starting leader monitoring as follower (interval: ${this.currentProbeInterval}ms)`
    );
    this.scheduleNextProbe();
  }

  /**
   * Schedule next probe with current interval + random jitter
   */
  private scheduleNextProbe(): void {
    if (!this.isRunning || this.role !== "follower") {
      return;
    }

    // Add random jitter (0-2000ms) to desynchronize followers
    const jitter = Math.floor(Math.random() * 2000);
    const delay = this.currentProbeInterval + jitter;

    this.electionTimer = setTimeout(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- setTimeout doesn't await callbacks
      async () => {
        await this.checkLeaderAndReelectIfNeeded();
        // Schedule next probe (interval may have changed)
        this.scheduleNextProbe();
      },
      delay
    );
  }

  /**
   * Check if leader is still alive, trigger re-election if needed
   * Also checks for provider changes from leader
   */
  private async checkLeaderAndReelectIfNeeded(): Promise<void> {
    // Skip if we're not a follower anymore
    if (this.role !== "follower" || this.state === "electing") {
      return;
    }

    const leader = await this.serverLock.getCurrentLeader();

    if (!leader) {
      // Leader is gone, try to become the new leader
      this.log.info(`[LeaderElection] Leader is gone, starting re-election`);
      this.increaseProbeInterval(); // Increase interval before election attempt

      try {
        const result = await this.electLeaderWithTimeout();

        if (result.isLeader) {
          // We became the leader - notify server to start HTTP server
          this.log.info(`[LeaderElection] Re-elected as leader`);
          this.stopMonitoring();
          this.notifyRoleChange(); // Notify server to start HTTP server
        } else if (result.leaderUrl) {
          // Another instance became leader, wait for it to be ready
          this.log.info(`[LeaderElection] New leader at ${result.leaderUrl}`);
          this.leaderUrl = result.leaderUrl;

          // Wait for leader server to be ready before notifying
          const leaderReady = await this.waitForLeaderReady(result.leaderUrl);
          if (leaderReady) {
            this.resetProbeInterval(); // Reset interval on successful recovery
          } else {
            this.increaseProbeInterval();
          }
          this.notifyRoleChange();
        }
      } catch (err) {
        // Election timeout or error
        this.log.error(`[LeaderElection] Re-election failed`, err);
        this.setState("waiting");
        this.increaseProbeInterval();
        this.notifyRoleChange(err instanceof Error ? err : new Error(String(err)));
      }
    } else if (this.leaderUrl !== `http://${leader.host}:${leader.port}`) {
      // Leader changed (new instance took over)
      this.log.info(
        `[LeaderElection] Leader changed to ${leader.instanceId} at ${leader.host}:${leader.port}`
      );
      this.leaderUrl = `http://${leader.host}:${leader.port}`;

      // Wait for new leader to be ready
      const leaderReady = await this.waitForLeaderReady(this.leaderUrl);
      if (leaderReady) {
        this.resetProbeInterval();
      } else {
        this.increaseProbeInterval();
      }
      this.notifyRoleChange();
    } else {
      const leaderHttpUp = await this.isLeaderHttpServing(leader);
      if (!leaderHttpUp) {
        this.log.info(
          `[LeaderElection] Leader ${leader.instanceId} lock is fresh but HTTP is down, starting re-election`
        );
        this.increaseProbeInterval();
        try {
          const result = await this.electLeaderWithTimeout();
          if (result.isLeader) {
            this.log.info(`[LeaderElection] Re-elected as leader after HTTP-down leader`);
            this.stopMonitoring();
            this.notifyRoleChange();
          } else if (result.leaderUrl) {
            this.leaderUrl = result.leaderUrl;
            const leaderReady = await this.waitForLeaderReady(result.leaderUrl);
            if (leaderReady) {
              this.resetProbeInterval();
            } else {
              this.increaseProbeInterval();
            }
            this.notifyRoleChange();
          }
        } catch (err) {
          this.log.error(`[LeaderElection] Re-election after HTTP-down leader failed`, err);
          this.setState("waiting");
          this.increaseProbeInterval();
          this.notifyRoleChange(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        this.resetProbeInterval();
      }
    }
  }

  /**
   * Stop monitoring (when becoming leader)
   */
  private stopMonitoring(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  /**
   * Register a callback for role changes
   */
  onRoleChanged(callback: RoleChangeCallback): void {
    this.onRoleChangeCallbacks.add(callback);
  }

  /**
   * Unregister a callback
   */
  offRoleChanged(callback: RoleChangeCallback): void {
    this.onRoleChangeCallbacks.delete(callback);
  }

  /**
   * Notify all registered callbacks of role change
   */
  private notifyRoleChange(error?: Error): void {
    const info: RoleChangeInfo = {
      role: this.role,
      state: this.state,
      leaderUrl: this.leaderUrl ?? undefined,
      error,
    };

    for (const callback of this.onRoleChangeCallbacks) {
      try {
        callback(info);
      } catch (err) {
        this.log.error("[LeaderElection] Error in role change callback", err);
      }
    }
  }

  /**
   * Get current role
   */
  getRole(): InstanceRole {
    return this.role;
  }

  /**
   * Get leader URL
   */
  getLeaderUrl(): string | null {
    return this.leaderUrl;
  }

  /**
   * Check if this instance is the leader
   */
  isLeader(): boolean {
    return this.role === "leader";
  }

  /**
   * Check if this instance is a follower
   */
  isFollower(): boolean {
    return this.role === "follower";
  }

  /**
   * Release leadership (when server fails to start)
   * This allows another instance to become leader
   */
  async releaseLeadership(): Promise<void> {
    if (this.role !== "leader") {
      return;
    }

    this.log.info(`[LeaderElection] Releasing leadership for instance ${this.instanceId}`);

    // Stop heartbeat timer
    this.stopHeartbeat();

    // Release the lock
    await this.serverLock.release(this.instanceId);

    await this.serverLock.close();

    // Update role and state
    this.role = "follower";
    this.setState("waiting"); // Waiting for new leader
    this.leaderUrl = null;
  }

  /**
   * Record a leadership failure (server failed to start)
   * After MAX_LEADERSHIP_FAILURES, stop trying to become leader
   */
  recordLeadershipFailure(): void {
    this.failedLeadershipAttempts++;
    this.log.warn(
      `[LeaderElection] Leadership failure recorded. Attempts: ${this.failedLeadershipAttempts}/${MAX_LEADERSHIP_FAILURES}`
    );

    if (this.failedLeadershipAttempts >= MAX_LEADERSHIP_FAILURES) {
      this.hasPortConflict = true;
      this.log.error(
        `[LeaderElection] Max leadership failures reached. Port ${this.port} may be in use by external process. Stopping election attempts.`
      );
    }
  }

  /**
   * Check if there's a port conflict (too many failed attempts)
   */
  hasExternalPortConflict(): boolean {
    return this.hasPortConflict;
  }

  /**
   * Notify that server started successfully (transition to leader_active)
   */
  notifyServerStarted(): void {
    if (this.role === "leader") {
      this.setState("leader_active");
      this.resetProbeInterval();
      this.log.info(`[LeaderElection] Server started, state is now leader_active`);
      this.startHeartbeat();
      // Notify listeners (StatusBarManager) to update UI
      this.notifyRoleChange();
    }
  }

  /**
   * Notify that server stopped
   */
  notifyServerStopped(): void {
    if (this.state === "leader_active") {
      this.setState("leader");
      this.stopHeartbeat();
      this.log.info(`[LeaderElection] Server stopped, state is now leader`);
      // Notify listeners (StatusBarManager) to update UI
      this.notifyRoleChange();
    }
  }

  /**
   * Start monitoring as follower (called when we failed to act as leader)
   */
  startMonitoringAsFollower(): void {
    if (!this.isRunning) {
      return;
    }

    this.log.info(
      `[LeaderElection] Starting leader monitoring as follower (after failed leadership)`
    );
    this.role = "follower";
    this.setState("waiting"); // Use waiting state since we just failed leadership

    // Stop any existing timers
    this.stopHeartbeat();

    // Reset probe interval and start monitoring
    this.resetProbeInterval();
    this.startMonitoring();
  }

  /**
   * Get info about current leader
   */
  async getCurrentLeaderInfo(): Promise<ServerLockInfo | null> {
    return this.serverLock.getCurrentLeader();
  }

  /**
   * Force trigger a re-election
   */
  async forceReelection(): Promise<ElectionResult> {
    this.log.info(`[LeaderElection] Force re-election triggered`);

    // Stop current timers
    this.stopHeartbeat();
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    // Release lock if we're leader
    if (this.role === "leader") {
      await this.serverLock.release(this.instanceId);
    }

    // Run election
    const result = await this.electLeader();

    // Restart timers based on new role
    if (this.isRunning) {
      if (result.isLeader) {
        if (this.state === "leader_active") {
          this.startHeartbeat();
        }
      } else {
        this.startMonitoring();
      }
    }

    return result;
  }
}
