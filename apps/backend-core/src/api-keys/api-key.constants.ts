/** Distinguishes an API key from a JWT at a glance — JWTs always start with "ey". */
export const API_KEY_PREFIX = 'exir_live_';

/** Length of the non-secret lookup prefix stored in ApiKey.keyPrefix (includes API_KEY_PREFIX itself). */
export const API_KEY_LOOKUP_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;
