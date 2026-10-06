export * from "./generated/api";
export * from "./generated/types";
// Orval names the query type and path validator alike; server callers need the validator.
export { PreviewNflTeamParams, GetNflScheduleParams, GetCaptainSalaryParams, GetNflStandingsParams } from "./generated/api";
