/**
 * SkillTrack Labs MCP server.
 *
 * Import-safe: no environment reads, no I/O and no throwing at module scope.
 * Every tool resolves its caller from the verified OAuth token and is scoped
 * to that person's organisation, workspaces, labs and sessions.
 */

import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { oauthIssuer } from "./config";
import extendSession from "./tools/extend-session";
import getSession from "./tools/get-session";
import health from "./tools/health";
import listLabs from "./tools/list-labs";
import listSessions from "./tools/list-sessions";
import reconnectSession from "./tools/reconnect-session";
import startLab from "./tools/start-lab";
import stopLab from "./tools/stop-lab";
import whoami from "./tools/whoami";

export default defineMcp({
  name: "skilltrack-labs-platform",
  title: "SkillTrack Labs Platform",
  version: "1.0.0",
  instructions: [
    "Tools for SkillTrack Labs, a cloud lab platform.",
    "Call skilltrack_whoami first to confirm the connected identity, and skilltrack_health to check deployment status.",
    "Use skilltrack_list_labs to find a lab, skilltrack_start_lab to launch it, then poll skilltrack_get_session until the machine reports READY.",
    "Sessions expire on a timer: skilltrack_extend_session adds time, skilltrack_stop_lab ends the session and releases the machine.",
    "Tools never return connection URLs, machine addresses or credentials; the learner opens the desktop inside SkillTrack Labs.",
  ].join(" "),
  auth: auth.oauth.issuer({ issuer: oauthIssuer(), acceptedAudiences: "authenticated" }),
  // The SDK's tool union is stricter than `exactOptionalPropertyTypes` allows
  // for tools that omit input/output schemas; the shapes themselves are valid.
  tools: [health, whoami, listLabs, listSessions, getSession, startLab, stopLab, extendSession, reconnectSession] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
