import { savedEliteTier } from '@/lib/elite-players';

export default function EliteBadge({ player }: { player: Parameters<typeof savedEliteTier>[0] }) {
  const tier = savedEliteTier(player);
  return tier ? <small className="elite-1x-badge" title={`${tier}x: ${tier * 20}% higher opportunity priority; QB rushing only`}>{tier}x</small> : null;
}