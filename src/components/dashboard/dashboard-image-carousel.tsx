'use client'

import { useEffect, useState } from 'react'
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
 * Full-width visual showcase — feature/guide banner images filling the
 * dashboard's open space above the metric cards. Same auto-advance/pause
 * pattern as DashboardGuideCarousel, but for full illustrated slides
 * instead of icon + text rows. The wrapper background matches the
 * slides' own gradient so object-contain letterboxing (slides have
 * different aspect ratios) blends in rather than showing bare edges.
 */
export function DashboardImageCarousel() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000)
    return () => clearInterval(id)
  }, [paused])

  const slide = SLIDES[index]

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ background: 'linear-gradient(135deg, #fff9e0 0%, #ffe999 55%, #ffd35c 100%)' }}
    >
      <div className="flex h-56 items-center justify-center sm:h-72 md:h-80 lg:h-96">
        {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset, same convention as logo-mark.png elsewhere */}
        <img src={slide.src} alt={slide.alt} className="h-full w-full object-contain" />
      </div>

      <button
        type="button"
        onClick={() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
        aria-label="Previous slide"
        className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-1.5 text-[#16143f] shadow-md transition hover:bg-white"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
        aria-label="Next slide"
        className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-1.5 text-[#16143f] shadow-md transition hover:bg-white"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-5 bg-[#16143f]' : 'w-1.5 bg-[#16143f]/30'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
