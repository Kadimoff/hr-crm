/** Server başlayanda bir dəfə: klientin real IP-si üçün soket ünvanını sorğu başlığına yazan qarmaq (bax: lib/auth/client-ip.ts) */
export async function register() {
  // Edge bundle-ına node:http düşməsin deyə import yalnız bu şərtin içində (Next.js sənədlərindəki nümunə)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installPeerAddressHeader } = await import("./lib/auth/peer-header");
    installPeerAddressHeader();
  }
}
