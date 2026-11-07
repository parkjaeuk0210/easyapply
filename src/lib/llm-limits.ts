import { intEnv } from "./server/config";

// Output includes the model's reasoning as well as the result JSON.
export const MAX_OUTPUT_TOKENS = 128_000;
// A 5-page notice already used ~13.6k. At the observed fast-mode rate
// (~330 tokens/s) 32k finishes in about 100 s, inside the LLM timeout.
// 자격 조건마다 비교 규칙(rule)을 함께 뽑으면서 49쪽 LH 공고가 32k에서 잘려(11-07) 48k로 올렸다(약 145초).
export const ANALYSIS_OUTPUT_TOKENS = 48_000;
export const MATCH_OUTPUT_TOKENS = 16_000;
// Total time for a route's AI work inside the 300 s function limit,
// leaving room to validate, sign and respond before the platform stops it.
export const REQUEST_BUDGET_MS = 280_000;

export const analysisOutputTokens = () => intEnv("EASYAPPLY_ANALYZE_OUTPUT_TOKENS", ANALYSIS_OUTPUT_TOKENS, 1000, MAX_OUTPUT_TOKENS);
export const matchOutputTokens = () => intEnv("EASYAPPLY_MATCH_OUTPUT_TOKENS", MATCH_OUTPUT_TOKENS, 1000, MAX_OUTPUT_TOKENS);
