import { io, type Socket } from "socket.io-client";
import { API_URL, getToken } from "./api";

const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, "");

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared `/ai-approvals` socket per tab — same pattern as support-socket.ts / voip-socket.ts. */
export function getAiApprovalSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;

  socket?.disconnect();
  socket = io(`${SOCKET_ORIGIN}/ai-approvals`, { auth: { token } });
  socketToken = token;
  return socket;
}
