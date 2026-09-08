import { getServerToast } from '~/lib/server-toast';

import { Toaster } from './toaster';

/**
 * Reads the pending toast and clears it.
 *
 * **Dynamic by construction** — it reads cookies — so it must sit inside its own
 * `<Suspense>` boundary in the layout. Without one it would pull every page out
 * of the static shell, which is the same trap the consent banner avoids by
 * reading its cookie in the browser. A toast cannot use that escape hatch: the
 * cookie has to be *deleted* on read, and only the server can do that.
 *
 * The cost is one small dynamic hole per page, which streams in after the shell
 * and blocks nothing.
 */
export async function ToasterGate() {
  return <Toaster toast={await getServerToast()} />;
}
