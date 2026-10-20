import { getHomeRecommendations } from "@/lib/recommendations/get-home-recommendations";
import { PersonalizedSection } from "./PersonalizedSection";

/**
 * The recommendations row as its own async boundary. It is the slowest read
 * on the page (several dependent query waves), so the page streams it in
 * behind a Suspense fallback instead of holding the whole page for it.
 */
export async function RecommendedSection() {
  const { items, personalised } = await getHomeRecommendations();
  return <PersonalizedSection items={items} personalised={personalised} />;
}
