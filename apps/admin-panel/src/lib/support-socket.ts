import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, "");

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared `/support` socket per tab for the admin panel — joins the global "admin" room server-side. */
export function getSupportSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;

  socket?.disconnect();
  socket = io(`${SOCKET_ORIGIN}/support`, { auth: { token } });
  socketToken = token;
  return socket;
}
