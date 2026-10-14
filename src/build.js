// Builds every page from the master partials, so all pages share one header (main menu), one
// footer, one <head> and the same scripts (including the accessibility tool).
//
//   src/partials/head.html      <head> — {{TITLE}}, {{EXTRA_CSS}}
//   src/partials/header.html    master main menu — {{LOGIN_CURRENT}}
//   src/partials/footer.html    master footer
//   src/partials/scripts.html   colour-vision filters + scripts — {{EXTRA_JS}}
//   src/pages/*.html            each page's own content
//
// Edit a partial or a page, then run:  node src/build.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/\s+$/, '');

const partials = {
  head: read('partials/head.html'),
  header: read('partials/header.html'),
  footer: read('partials/footer.html'),
  scripts: read('partials/scripts.html'),
};

const PAGES = [
  {
    file: 'index.html',
    title: 'الرئيسية',
    canvasClass: 'bg-[#f2f2f2]',
    before: 'pages/index.before.html', // hero image + background patterns, painted under the header
    main: 'pages/index.main.html',
  },
  {
    file: 'login.html',
    title: 'تسجيل الدخول',
    canvasClass: 'bg-white',
    main: 'pages/login.main.html',
    css: ['css/forms.css'],
    js: ['js/forms.js'],
    current: 'login',
  },
  {
    file: 'register.html',
    title: 'إنشاء حساب جديد',
    canvasClass: 'bg-white',
    main: 'pages/register.main.html',
    css: ['css/forms.css'],
    js: ['js/forms.js'],
  },
];

for (const page of PAGES) {
  const head = partials.head
    .replace('{{TITLE}}', page.title)
    .replace('{{EXTRA_CSS}}', (page.css || []).map((href) => `  <link rel="stylesheet" href="${href}" />\n`).join(''));
  const header = partials.header.replace('{{LOGIN_CURRENT}}', page.current === 'login' ? 'aria-current="page" ' : '');
  const scripts = partials.scripts.replace('{{EXTRA_JS}}', (page.js || []).map((src) => `  <script src="${src}"></script>\n`).join(''));

  const html = [
    head,
    '<body class="font-din text-black antialiased">',
    '  <a href="#main" class="skip-link">تخطي إلى المحتوى الرئيسي</a>',
    '',
    `  <div id="canvas" class="page-canvas relative overflow-hidden ${page.canvasClass}">`,
    page.before ? '\n' + read(page.before) + '\n' : '',
    header,
    '',
    read(page.main),
    '',
    partials.footer,
    '  </div>',
    '',
    scripts,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(root, page.file), html);
  console.log('built', page.file);
}
