// The entry point. `index.html` loads this as a module and nothing else runs.
//
// The page opens on a run. `?encounter=<id>` (or `?mode=fight`) opens the
// single addressable fight instead, which is what `tools/ui-probe/play.ts`
// photographs and what `README.md` links.

import { startApp } from './app.ts';
import { startRunApp } from './runapp.ts';

const params = new URLSearchParams(globalThis.location.search);
if (params.get('mode') === 'fight' || params.has('encounter')) startApp();
else startRunApp();
