import {
  MessageCircle,
  MessageSquare,
  Inbox,
  Megaphone,
  BarChart3,
  Zap,
  Sparkles,
  Bot,
  Code2,
  QrCode,
  Contact,
  Phone,
  FileText,
  Radio,
  Bell,
  Calendar,
  Workflow,
  User,
  type LucideIcon,
} from "lucide-react";

interface PatternIcon {
  Icon: LucideIcon;
  top: string;
  left: string;
  size: number;
  rotate: number;
  opacity: number;
}

// Deterministic "scattered" placement — hand-picked positions, sizes,
// rotations, and opacities so the pattern never causes a hydration
// mismatch (a Math.random() version would differ between server and
// client render) while still reading as organic rather than gridded.
// Only visible on the Ember theme — see .bg-pattern-layer in globals.css.
const ICONS: PatternIcon[] = [
  { Icon: MessageCircle, top: "4%", left: "8%", size: 44, rotate: -12, opacity: 0.03 },
  { Icon: MessageSquare, top: "14%", left: "92%", size: 36, rotate: 8, opacity: 0.025 },
  { Icon: Inbox, top: "26%", left: "3%", size: 52, rotate: 6, opacity: 0.035 },
  { Icon: Megaphone, top: "6%", left: "45%", size: 28, rotate: -15, opacity: 0.02 },
  { Icon: BarChart3, top: "38%", left: "78%", size: 48, rotate: 10, opacity: 0.03 },
  { Icon: Zap, top: "48%", left: "20%", size: 24, rotate: 14, opacity: 0.025 },
  { Icon: Sparkles, top: "62%", left: "88%", size: 32, rotate: -8, opacity: 0.03 },
  { Icon: Bot, top: "70%", left: "6%", size: 56, rotate: 5, opacity: 0.035 },
  { Icon: Code2, top: "82%", left: "40%", size: 30, rotate: -6, opacity: 0.02 },
  { Icon: QrCode, top: "18%", left: "62%", size: 34, rotate: 12, opacity: 0.025 },
  { Icon: Contact, top: "54%", left: "50%", size: 40, rotate: -10, opacity: 0.02 },
  { Icon: Phone, top: "90%", left: "80%", size: 26, rotate: 15, opacity: 0.03 },
  { Icon: FileText, top: "32%", left: "12%", size: 30, rotate: -13, opacity: 0.025 },
  { Icon: Radio, top: "8%", left: "75%", size: 38, rotate: 9, opacity: 0.02 },
  { Icon: Bell, top: "58%", left: "6%", size: 24, rotate: -5, opacity: 0.03 },
  { Icon: Calendar, top: "44%", left: "95%", size: 42, rotate: 7, opacity: 0.025 },
  { Icon: Workflow, top: "76%", left: "60%", size: 46, rotate: -14, opacity: 0.03 },
  { Icon: User, top: "94%", left: "20%", size: 28, rotate: 11, opacity: 0.02 },
  { Icon: MessageCircle, top: "68%", left: "35%", size: 22, rotate: 13, opacity: 0.02 },
  { Icon: BarChart3, top: "2%", left: "22%", size: 30, rotate: -9, opacity: 0.025 },
];

export function BackgroundPattern() {
  return (
    <div
      aria-hidden
      className="bg-pattern-layer pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {ICONS.map(({ Icon, top, left, size, rotate, opacity }, i) => (
        <Icon
          key={i}
          width={size}
          height={size}
          strokeWidth={1.5}
          className="absolute text-foreground"
          style={{
            top,
            left,
            opacity,
            transform: `rotate(${rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
