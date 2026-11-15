import { VenueDetail } from "@/components/console/venue-detail";

/** One venue. The id is the address's; the API refuses anything that is not a venue of the platform. */
export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VenueDetail id={id} />;
}
