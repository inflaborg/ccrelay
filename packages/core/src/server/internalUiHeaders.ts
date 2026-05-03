/**
 * Fixed HTTP header gate for `/ccrelay` static SPA. Open-source deterrent only;
 * use server.apiBearerToken for real API isolation.
 */

export const CCRELAY_UI_HEADER_NAME = "X-CCRelay-Internal-UI";

/** Deliberately constant shared value (see plan). Not a cryptographic secret. */
export const CCRELAY_UI_HEADER_VALUE = "ccrelay-internal-1";
