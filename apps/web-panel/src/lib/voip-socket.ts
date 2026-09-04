import { io, type Socket } from "socket.io-client";
import { API_URL, getToken } from "./api";

const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, "");

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared `/voip` socket per tab, re-created only when the auth token changes — same pattern as support-socket.ts. */
export function getVoipSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;

  socket?.disconnect();
  socket = io(`${SOCKET_ORIGIN}/voip`, { auth: { token } });
  socketToken = token;
  return socket;
}
