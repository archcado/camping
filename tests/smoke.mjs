import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const mainRuntimeOrder = ['config.js', 'storage.js', 'state.js', 'formatters.js', 'validators.js', 'cart-service.js'];

function readProjectFile(relativePath) {
  return readFileSync(join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFileExists(relativePath) {
  assert(existsSync(join(rootDir, relativePath)), `Missing required file: ${relativePath}`);
}

function assertRuntimeScriptOrder(relativePath) {
  const html = readProjectFile(relativePath);
  const positions = mainRuntimeOrder.map((fileName) => html.indexOf(fileName));
  assert(positions.every((index) => index !== -1), `${relativePath} is missing split runtime scripts`);
  positions.slice(1).forEach((position, index) => {
    assert(position > positions[index], `${relativePath} runtime scripts are out of order`);
  });
}

function getHtmlPages(relativeDir) {
  return readdirSync(join(rootDir, relativeDir))
    .filter((fileName) => fileName.endsWith('.html'))
    .map((fileName) => `${relativeDir}/${fileName}`);
}

function assertHeaderRoot(pagePath, expectedContext) {
  const html = readProjectFile(pagePath);
  const headerRootCount = (html.match(/id="header"/g) || []).length;
  const bookingHeaderCount = (html.match(/id="booking-header"/g) || []).length;
  const contextMatch = html.match(/<div id="header"[^>]*data-header-context="([^"]+)"/);
  const themeHeaderLoaded = html.includes('theme-header.css');

  assert(headerRootCount === 1, `${pagePath} should have exactly one #header root`);
  assert(bookingHeaderCount === 0, `${pagePath} should not contain #booking-header`);
  assert(contextMatch, `${pagePath} should declare data-header-context`);
  assert(['shop', 'camp'].includes(contextMatch[1]), `${pagePath} context must be shop/camp`);
  assert(contextMatch[1] === expectedContext, `${pagePath} should use ${expectedContext} context`);
  assert(themeHeaderLoaded, `${pagePath} should load theme-header.css`);
}

[
  'package.json',
  'vite.config.js',
  'eslint.config.js',
  'stylelint.config.cjs',
  '.prettierrc.json',
  'src/styles.js',
  'js/storage.js',
  'js/state.js',
  'js/formatters.js',
  'js/validators.js',
  'js/cart-service.js',
  'css/theme/theme-header.css',
].forEach(assertFileExists);

const shopPages = getHtmlPages('pages');
const campPages = getHtmlPages('booking/pages');

shopPages.forEach((pagePath) => {
  assertRuntimeScriptOrder(pagePath);
  assertHeaderRoot(pagePath, 'shop');
});

campPages.forEach((pagePath) => {
  assertHeaderRoot(pagePath, 'camp');
});

const headerPartial = readProjectFile('components/header.partial');
assert((headerPartial.match(/data-layout-part="shared-site-header"/g) || []).length === 1, 'header.partial must define shared-site-header once');
assert((headerPartial.match(/data-layout-part="shared-auth"/g) || []).length === 1, 'header.partial must define shared-auth once');
assert((headerPartial.match(/data-layout-part="shared-site-cart-panel"/g) || []).length === 1, 'header.partial must define shared-site-cart-panel once');
assert((headerPartial.match(/data-layout-part="shared-booking-cart-panel"/g) || []).length === 1, 'header.partial must define shared-booking-cart-panel once');
assert(headerPartial.includes('class="yr-site-header-shell"'), 'shared-site-header must include .yr-site-header-shell');
assert(headerPartial.includes('class="yr-site-header'), 'shared-site-header must include .yr-site-header');
assert(headerPartial.includes('class="yr-site-menu-toggle"'), 'shared-site-header must include .yr-site-menu-toggle');
assert(headerPartial.includes('data-header-actions'), 'shared-site-header must include [data-header-actions]');
assert(headerPartial.includes('data-header-drawer'), 'shared-site-header must include [data-header-drawer]');
assert(headerPartial.includes('data-header-overlay'), 'shared-site-header must include [data-header-overlay]');

const sharedHeaderFragment = headerPartial
  .split('<div data-layout-part="shared-site-header">')[1]
  ?.split('<div data-layout-part="shared-site-cart-panel">')[0] || '';
assert(!sharedHeaderFragment.includes('id="siteCartDrawer"'), 'shared-site-header should not inline shop cart panel');
assert(!sharedHeaderFragment.includes('id="cartPanel"'), 'shared-site-header should not inline booking panel');

const mainJs = readProjectFile('js/main.js');
assert(mainJs.includes('[data-layout-part="shared-site-header"]'), 'main.js should always load shared-site-header');
assert(!mainJs.includes('[data-layout-part="main-header"]'), 'main.js should not fallback to main-header');
assert(mainJs.includes('Missing or invalid data-header-context on #header'), 'main.js should fail loudly on missing context');
assert(mainJs.includes("!document.getElementById('siteCartDrawer')"), 'main.js should guard against duplicate shop cart panel');

const bookingLayoutJs = readProjectFile('booking/js/layout.js');
assert(bookingLayoutJs.includes('[data-layout-part="shared-site-header"]'), 'booking layout should load shared-site-header');
assert(bookingLayoutJs.includes('#header[data-header-context="camp"]'), 'booking layout should prioritize #header[data-header-context="camp"]');
assert(bookingLayoutJs.includes('#booking-header'), 'booking layout should keep legacy #booking-header fallback during migration');
assert(bookingLayoutJs.includes("if (document.getElementById('cartPanel')) return true;"), 'booking layout should guard booking cart panel singleton');
assert(bookingLayoutJs.includes('[data-layout-part="shared-booking-cart-panel"]'), 'booking layout should request shared booking cart panel');
assert(bookingLayoutJs.includes('target.insertAdjacentHTML(\'beforeend\''), 'booking layout should append auth/panel instead of replacing shared header');
assert(bookingLayoutJs.includes('Failed to load shared-site-header'), 'booking layout should log shared-site-header load failures');

const sharedHeaderController = readProjectFile('js/components/header.js');
assert(sharedHeaderController.includes('data-auth-login-trigger'), 'shared header should render auth login trigger hook');
assert(sharedHeaderController.includes('root.dataset.headerInitializedContext = context;'), 'shared header should persist initialized context');
assert(sharedHeaderController.includes('_sharedHeaderStructureReady(root)'), 'shared header should validate structure before complete');
assert(sharedHeaderController.includes('_sharedHeaderContentReady(root)'), 'shared header should validate content before complete');
assert(bookingLayoutJs.includes('loadBookingHeaderScriptShared'), 'booking layout should initialize shared header runtime chain');
assert(bookingLayoutJs.includes('loadBookingHeaderScriptLegacy'), 'booking layout should keep legacy runtime chain during migration');

const authJs = readProjectFile('js/components/auth.js');
assert(authJs.includes('window.initAuth = function initAuth()'), 'auth.js should expose initAuth');

const checkoutSuccessHtml = readProjectFile('pages/checkout-success.html');
assert(!/initNavbar\(|window\.initNavbar/.test(checkoutSuccessHtml), 'checkout-success should not re-run header initialization');

const pageScripts = [
  'js/pages/product-list.js',
  'js/pages/blog.js',
  'js/pages/blog-detail.js',
  'js/pages/faq.js',
  'js/pages/branches.js',
  'js/pages/checkout.js',
];
pageScripts.forEach((pageScript) => {
  const source = readProjectFile(pageScript);
  assert(!/initNavbar\(|window\.initNavbar/.test(source), `${pageScript} should not directly call initNavbar`);
});

const mainCss = readProjectFile('css/main.css');
assert(mainCss.includes('.cart-drawer'), 'main.css should keep shop cart drawer styles');
const bookingCss = readProjectFile('booking/css/booking.css');
assert(bookingCss.includes('.bk-slide-panel'), 'booking.css should keep booking panel styles');

console.log('Smoke checks passed');
