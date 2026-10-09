import { requireAdmin } from "@/lib/auth";
import PromotionsClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Free gift offers" };

export default async function PromotionsPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "promotions");
  return <PromotionsClient />;
}
