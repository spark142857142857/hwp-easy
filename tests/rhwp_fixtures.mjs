/** Personal-data-free real HWP fixtures; initialize only the pinned Node bridge. */
import { HwpDocument } from '@rhwp/core';
import { exportChecked } from '../src/one_hwp/rhwp_bridge.mjs';
import { syntheticFixture, corpus } from '../src/one_hwp/synthetic_fixtures.mjs';
export { corpus };
export const fixture = (options = {}) => syntheticFixture(HwpDocument, exportChecked, options);
