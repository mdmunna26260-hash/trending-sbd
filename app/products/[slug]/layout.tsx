import { loadClientPromotionConfig } from "@/lib/promotions/config-server";
import { PromotionConfigProvider } from "@/components/combo-offer";

/* Provides the PDP gift nudge with the same server-loaded offer config. */
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const config = await loadClientPromotionConfig();
  return <PromotionConfigProvider config={config}>{children}</PromotionConfigProvider>;
}
