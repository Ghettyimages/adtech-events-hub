import ItineraryDetailClient from '@/components/itinerary/ItineraryDetailClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ItineraryDetailPage({ params }: PageProps) {
  const { slug } = await params;
  return <ItineraryDetailClient slug={slug} />;
}
