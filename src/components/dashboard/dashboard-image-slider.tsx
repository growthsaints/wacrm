'use client'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
 * Feature/guide banner slider — images sit inline in a single scrollable
 * row instead of stacking (the earlier masonry grid pushed the rest of
 * the dashboard down). Each slide keeps a fixed height with its native
 * aspect ratio (width auto), so nothing is cropped or letterboxed; the
 * row scrolls/snaps horizontally via drag, trackpad, or the arrows.
 */
export function DashboardImageSlider() {
  const scrollerRef = useRef<HTMLDivElement>(null)

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {SLIDES.map((slide) => (
          <div
            key={slide.src}
            className="h-56 shrink-0 overflow-hidden rounded-xl shadow-sm sm:h-64 md:h-72"
            style={{ scrollSnapAlign: 'start' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset, same convention as logo-mark.png elsewhere */}
            <img src={slide.src} alt={slide.alt} className="block h-full w-auto" />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        aria-label="Scroll left"
        className="absolute left-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-1.5 text-[#16143f] shadow-md transition hover:bg-white sm:flex"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => scrollByPage(1)}
        aria-label="Scroll right"
        className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-1.5 text-[#16143f] shadow-md transition hover:bg-white sm:flex"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}
