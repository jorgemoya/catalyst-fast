import { getProductAvailability } from '~/data/inventory';
import { getProductPrice } from '~/data/pricing';
import { getDefaultCurrency } from '~/lib/currency';
import { getProduct } from '~/data/product';
import { getStoreSettings } from '~/data/settings';
import { toSchemaAvailability } from '~/domain/availability';
import { buildConfig } from '~/lib/config';

/**
 * Product structured data.
 *
 * Every read here is the same cached function the visible page already used, so
 * the JSON-LD costs nothing extra — it reuses `getProduct`, `getProductPrice`,
 * and `getProductAvailability` entries that are already warm.
 *
 * Prices are the **default customer group's**, matching what an anonymous
 * crawler sees on the page. Emitting a personalized price would misrepresent the
 * offer in search results.
 */
export async function ProductJsonLd({ productId }: { productId: number }) {
  const [product, price, availability, settings] = await Promise.all([
    getProduct(productId),
    // Default currency deliberately: structured data describes the public
    // offer a crawler sees, and crawlers hold no currency cookie.
    getProductPrice(productId, await getDefaultCurrency()),
    getProductAvailability(productId),
    getStoreSettings(),
  ]);

  if (!product) {
    return null;
  }

  const origin = buildConfig.get('urls').vanityUrl;
  const url = `${origin}${product.path}`;

  // A range needs low/high price; everything else is a single offer.
  const offers =
    price?.type === 'range'
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: price.min.currencyCode,
          lowPrice: price.mode === 'INC' ? price.min.inc : price.min.ex,
          highPrice: price.mode === 'INC' ? price.max.inc : price.max.ex,
          availability: availability ? toSchemaAvailability(availability) : undefined,
          url,
        }
      : price
        ? {
            '@type': 'Offer',
            priceCurrency:
              price.type === 'sale' ? price.current.currencyCode : price.money.currencyCode,
            price:
              price.type === 'sale'
                ? price.mode === 'INC'
                  ? price.current.inc
                  : price.current.ex
                : price.mode === 'INC'
                  ? price.money.inc
                  : price.money.ex,
            availability: availability ? toSchemaAvailability(availability) : undefined,
            url,
          }
        : undefined;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.plainTextDescription || undefined,
    sku: product.sku || undefined,
    url,
    image: product.images.map((image) => image.src),
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers,
    // Only emitted when reviews exist and the merchant displays ratings —
    // an aggregateRating with zero reviews is a structured-data error.
    aggregateRating:
      settings.showProductRating && product.numberOfReviews > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: product.rating,
            reviewCount: product.numberOfReviews,
          }
        : undefined,
  };

  return (
    <script
      // JSON.stringify drops undefined keys, which is what keeps optional fields
      // out of the output rather than emitting nulls.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      type="application/ld+json"
    />
  );
}
