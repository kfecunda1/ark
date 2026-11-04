// Fixed set of banking products ARK tracks. Unlike the old free-text
// field, this is a closed list — adding an 8th product is a code change,
// not something a user types in.
export const PRODUCT_TYPES = ["SBLC", "MX103", "MT103", "IP-IP", "API", "T2T", "S2S"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
