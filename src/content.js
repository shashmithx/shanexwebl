import {
  CalendarClock,
  CheckCircle2,
  Cloud,
  Code2,
  Download,
  Layers3,
  MonitorCog,
  Palette,
  PenTool,
  Printer,
  ReceiptText,
  ShoppingBag,
  ShieldCheck,
} from 'lucide-react';

export const siteContent = {
  brand: {
    name: 'SHANEX',
    tagline: 'DEVELOP - DESIGN - PRINT',
    email: 'hello@shanex.com',
  },
  navigation: [
    ['Home', '#/'],
    ['About', '#/about'],
    ['Downloads', '#/downloads'],
    ['Shop', '#/shop'],
    ['Contact', '#/contact'],
  ],
  footer: {
    description:
      'SHANEX provides brand, digital and print production support for businesses that need consistent communication across every touchpoint.',
    columns: [
      ['Company', [['About', '#/about'], ['Contact', '#/contact'], ['Home', '#/']]],
      ['Services', [['Printing', '#/#services'], ['Graphic Design', '#/#services'], ['Software / Tech', '#/#services']]],
      ['Resources', [['Downloads', '#/downloads'], ['Shop', '#/shop'], ['Print Manager', '#/downloads']]],
    ],
  },
  hero: {
    eyebrow: 'Brand, digital and print production',
    titleLead: 'Build a clearer brand',
    titleStrong: 'from idea to delivery.',
    description:
      'SHANEX helps businesses plan, design, develop and produce the materials they need to launch, operate and grow with consistency.',
    primaryAction: 'Discuss a Project',
    secondaryAction: 'View Capabilities',
    pills: ['Brand identity', 'Web and software', 'Print production'],
  },
  marquee: ['Brand Strategy', 'Identity Design', 'Web Development', 'Print Production', 'Business Tools', 'Launch Support'],
  scrollStory: {
    number: '01',
    eyebrow: 'Integrated project delivery',
    title: 'A structured workflow from brief to finished output.',
    description:
      'We bring planning, design, development and production into one coordinated process, reducing delays and keeping every touchpoint aligned.',
    steps: [
      ['Plan', 'Define the objective, audience, scope, content requirements and delivery timeline.'],
      ['Create', 'Develop the visual direction, layouts, interfaces, assets and required technical components.'],
      ['Deliver', 'Prepare production files, deploy digital assets, document handover details and support launch.'],
    ],
  },
  servicesIntro: {
    number: '02',
    title: 'Practical services for brand and business communication.',
    description:
      'Whether the requirement is visual, digital or physical, each deliverable is prepared with clear standards and long-term usability in mind.',
  },
  services: [
    {
      title: 'Printing',
      kicker: 'Production-ready material',
      icon: Printer,
      gradient: 'blue',
      text: 'Design and preparation for business stationery, packaging, labels, signage, flyers, forms and campaign material with print-ready files.',
      tags: ['Stationery', 'Packaging', 'Marketing material'],
    },
    {
      title: 'Graphic Design',
      kicker: 'Consistent visual communication',
      icon: PenTool,
      gradient: 'violet',
      text: 'Logo design, brand identity, social media creatives, presentations, posters, UI direction and campaign visuals built around a clear system.',
      tags: ['Identity design', 'Campaign assets', 'Presentations'],
    },
    {
      title: 'Software / Tech',
      kicker: 'Digital tools and websites',
      icon: Code2,
      gradient: 'cyan',
      text: 'Responsive websites, web applications, dashboards, internal tools and automation workflows designed to support business operations.',
      tags: ['Websites', 'Web apps', 'Automation'],
    },
  ],
  studio: {
    number: '03',
    title: 'A clear working standard for every project.',
    description:
      'Our work is organized around clean typography, consistent spacing, responsive layouts, structured files, correct export formats and clear handover documentation.',
    features: [
      ['Responsive digital interfaces', MonitorCog],
      ['Brand-aligned visual assets', Palette],
      ['Production-ready file exports', Layers3],
      ['Support for cloud workflows', Cloud],
    ],
  },
  releasesIntro: {
    number: '04',
    title: 'Software products developed by SHANEX.',
    description:
      'We also develop focused software products for operational teams that need simpler management, tracking and reporting workflows.',
  },
  releases: [
    {
      name: 'Print Manager',
      version: 'v1.0',
      status: 'Coming soon',
      icon: Printer,
      summary:
        'A print shop management system for quotations, job cards, order tracking, customer records, production notes and delivery handover.',
      highlights: [
        ['Smart job cards', ReceiptText],
        ['Order timeline', CalendarClock],
        ['Secure customer data', ShieldCheck],
        ['Installer ready', Download],
      ],
      metrics: [
        ['Quotes', 'Fast estimates'],
        ['Jobs', 'Live tracking'],
        ['Files', 'Print-ready notes'],
      ],
      action: 'Ask about Print Manager',
    },
  ],
  processIntro: {
    number: '05',
    title: 'A simple process with clear accountability.',
  },
  process: [
    ['Scope', 'Confirm objectives, deliverables, priorities, timeline and the information required to begin.'],
    ['Prototype', 'Review structure, content, layouts and key interactions before final production begins.'],
    ['Produce', 'Create the approved designs, files, website, software components or print-ready assets.'],
    ['Handover', 'Deliver final exports, source files, deployment notes and support guidance clearly.'],
  ],
  faqsIntro: {
    number: '06',
    title: 'Common project questions.',
  },
  faqs: [
    [
      'Can I start with only one service?',
      'Yes. A project can begin with a single requirement such as a logo, website, printed item or internal software tool.',
    ],
    [
      'Do you prepare final files for printing?',
      'Yes. We prepare print-ready artwork with correct sizing, export formats, bleed requirements and production notes.',
    ],
    [
      'Can you maintain the project after launch?',
      'Yes. Ongoing support can include content updates, small design changes, hosting handover, bug fixes and future improvements.',
    ],
  ],
  contact: {
    number: '07',
    title: 'Start with a clear brief and the right delivery plan.',
  },
  aboutPage: {
    eyebrow: 'About SHANEX',
    title: 'A practical creative and technology partner for growing businesses.',
    description:
      'SHANEX supports businesses with brand identity, digital interfaces, print production and operational software. The focus is simple: clear communication, reliable output and organized delivery.',
    stats: [
      ['3', 'Core service areas'],
      ['1', 'Integrated workflow'],
      ['100%', 'Production-focused output'],
    ],
    values: [
      ['Clarity', 'Every project starts with a clear objective, audience and delivery scope.'],
      ['Consistency', 'Visual and digital assets are prepared to work together across channels.'],
      ['Reliability', 'Files, exports, launch notes and handover details are kept organized.'],
    ],
  },
  downloadsPage: {
    eyebrow: 'Downloads',
    title: 'Software, resources and release files from SHANEX.',
    description:
      'Downloadable products and support material will be listed here as they become available.',
    downloads: [
      {
        name: 'Print Manager',
        version: 'v1.0',
        status: 'Coming soon',
        icon: Download,
        description:
          'A print shop management system for quotations, job cards, order tracking and production handover.',
        meta: ['Windows installer planned', 'Release notes included', 'Setup guide planned'],
      },
      {
        name: 'Brand Starter Checklist',
        version: 'PDF',
        status: 'Planned',
        icon: CheckCircle2,
        description:
          'A practical checklist for preparing logos, colors, content and print material before launch.',
        meta: ['Brand basics', 'Print preparation', 'Website content'],
      },
    ],
  },
  shopPage: {
    eyebrow: 'Shop',
    title: 'Order SHANEX products and service packages online.',
    description:
      'Customers can login, add products to cart and place orders. Admin users can manage products in the static browser store prepared for Cloudflare Pages.',
    products: [
      {
        name: 'Business Launch Kit',
        status: 'Coming soon',
        icon: ShoppingBag,
        description: 'Logo refinement, business card design, letterhead and social launch graphics.',
      },
      {
        name: 'Print Manager License',
        status: 'Coming soon',
        icon: Printer,
        description: 'Software license and setup package for print shop workflow management.',
      },
      {
        name: 'Website Starter Package',
        status: 'Coming soon',
        icon: Code2,
        description: 'A focused website setup for small businesses that need a clean online presence.',
      },
    ],
  },
  contactPage: {
    eyebrow: 'Contact',
    title: 'Tell us what you need to build, design or produce.',
    description:
      'Send a short brief with your business name, required service, timeline and any existing brand material. SHANEX will respond with the next practical step.',
    details: [
      ['Email', 'hello@shanex.com'],
      ['Services', 'Brand, web, software and print production'],
      ['Availability', 'Project-based work and product support'],
    ],
  },
};
