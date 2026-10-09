import { loadClientPromotionConfig } from "@/lib/promotions/config-server";
import { PromotionConfigProvider } from "@/components/combo-offer";

/* The active promotion is read on the server and handed to the browser, so the
   cart/checkout gift panel never depends on a client fetch. */
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const config = await loadClientPromotionConfig();
  return <PromotionConfigProvider config={config}>{children}</PromotionConfigProvider>;
}
