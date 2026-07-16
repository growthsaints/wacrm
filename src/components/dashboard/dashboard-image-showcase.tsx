interface ImageSlide {
  src: string
  alt: string
}

const SLIDES: ImageSlide[] = [
  {
    src: '/dashboard/carousel/image1-getting-started.png',
    alt: 'Getting started: connect WhatsApp to Growth Saints in four steps',
  },
  {
    src: '/dashboard/carousel/image2-features.png',
    alt: 'Powerful CRM features overview',
  },
  {
    src: '/dashboard/carousel/image3-how-to-use.png',
    alt: 'How a WhatsApp message flows into a CRM reply',
  },
  {
    src: '/dashboard/carousel/image4-whatsapp-info.png',
    alt: 'How your personal WhatsApp connects securely',
  },
  {
    src: '/dashboard/carousel/image5-benefits.png',
    alt: 'Why Growth Saints matters for customer relationships',
  },
]

/**
 * Feature/guide banner gallery for the dashboard's open space, laid out
 * as a CSS-columns masonry so each image keeps its own native aspect
 * ratio (they range from 2.8:1 to 1.5:1) instead of being letterboxed
 * or cropped to a shared frame.
 */
export function DashboardImageShowcase() {
  return (
    <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
      {SLIDES.map((slide) => (
        <div key={slide.src} className="mb-4 break-inside-avoid overflow-hidden rounded-xl shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset, same convention as logo-mark.png elsewhere */}
          <img src={slide.src} alt={slide.alt} className="block h-auto w-full" />
        </div>
      ))}
    </div>
  )
}
