import http from "node:http";
import { PEER_HEADER } from "./client-ip";

const INSTALLED = Symbol.for("hrcrm.peerHeader");

/**
 * Hər HTTP sorğusuna TCP soketin ünvanını {@link PEER_HEADER} başlığı kimi yazır (klientin göndərdiyi dəyər üzərinə yazılır).
 * App Router-də (server action, route handler) soketə birbaşa çıxış yoxdur — yalnız başlıqlar görünür.
 */
export function installPeerAddressHeader(): void {
  const proto = http.Server.prototype as http.Server & { [INSTALLED]?: boolean };
  if (proto[INSTALLED]) return;
  const emit = proto.emit;
  proto.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const req = args[0] as http.IncomingMessage | undefined;
      if (req?.headers) req.headers[PEER_HEADER] = req.socket?.remoteAddress ?? "";
    }
    return Reflect.apply(emit, this, [event, ...args]) as boolean;
  } as typeof proto.emit;
  proto[INSTALLED] = true;
}
