import { getStoreSettings } from '~/data/settings';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

export async function StoreLogo({ className }: { className?: string }) {
  const { logo, storeName } = await getStoreSettings();

  return (
    <Link aria-label={storeName} className={className} href="/">
      {logo.type === 'image' ? (
        /*
         * Height-constrained, with **no asserted aspect ratio**.
         *
         * A merchant logo can be any shape, and BigCommerce's `Image` type
         * exposes only URL variants — no width or height — so its ratio is
         * genuinely unknowable here. The previous `width={160} height={32}` was a
         * guess, and when the real logo turned out to be square the browser sized
         * it from the *actual* ratio while Next expected the declared one:
         *
         *   Image ... has either width or height modified, but not the other.
         *
         * `width={0} height={0}` with `sizes` is Next's idiom for exactly this —
         * assert nothing, let CSS lay it out, and drive `srcset` from `sizes`.
         *
         * `sizes` is the rendered width, not the source width. At 160px it asks
         * the CDN for 160w/320w; the old declaration was pulling 384w for what
         * turned out to be a 50px image.
         *
         * `priority` because this is above the fold on every page.
         */
        <Image
          alt={logo.alt}
          className="h-8 w-auto object-contain"
          height={0}
          priority
          sizes="160px"
          src={logo.src}
          width={0}
        />
      ) : (
        <span className="text-lg font-semibold tracking-tight">{logo.text}</span>
      )}
    </Link>
  );
}
