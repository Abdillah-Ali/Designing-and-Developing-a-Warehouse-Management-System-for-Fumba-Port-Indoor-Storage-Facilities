import { io } from "socket.io-client";
import { getStoredAuthToken } from "@/lib/portal-access";
import { API_BASE_URL } from "@/services/api";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, "");

export const createScannerSocket = () => {
  const token = getStoredAuthToken();

  return io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
    transports: ["websocket", "polling"]
  });
};
