import { io, type Socket } from "socket.io-client";
import { API_URL, getToken } from "./api";

const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, "");

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared `/support` socket per tab, re-created only when the auth token changes. */
export function getSupportSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;

  socket?.disconnect();
  socket = io(`${SOCKET_ORIGIN}/support`, { auth: { token } });
  socketToken = token;
  return socket;
}
