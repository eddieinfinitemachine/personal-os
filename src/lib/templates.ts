// Sidebar "templates" — pre-built list/dashboard surfaces the user can
// opt into. By default only Home + Calendar render; users add templates
// from a picker in the sidebar. Persisted client-side per browser via
// localStorage (key `STORAGE_KEY`).

import {
  BookOpen,
  Car,
  Lightbulb,
  MapPin,
  Package,
  Plane,
  Printer,
  TrendingUp,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export type TemplateSlug =
  | "reader"
  | "highlights"
  | "personal"
  | "friends"
  | "vehicles"
  | "trips"
  | "investments"
  | "inventory"
  | "media"
  | "places"
  | "best-practices"
  | "print-lists";

export type SidebarTemplate = {
  slug: TemplateSlug;
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  privateOnly?: boolean;
};

export const TEMPLATES: SidebarTemplate[] = [
  {
    slug: "reader",
    href: "/reader",
    label: "Read later",
    description: "Links, tweets, and articles saved from the share sheet — with a reader view and highlights.",
    Icon: BookOpen,
  },
  {
    slug: "highlights",
    href: "/highlights",
    label: "Highlights",
    description: "Every passage you've highlighted while reading, in one place.",
    Icon: Lightbulb,
  },
  {
    slug: "personal",
    href: "/personal",
    label: "Personal",
    description: "Your birth record, passport, parents — the official profile.",
    Icon: User,
    privateOnly: true,
  },
  {
    slug: "friends",
    href: "/friends",
    label: "Friends",
    description: "People you keep up with, last interaction, upcoming birthdays.",
    Icon: Users,
  },
  {
    slug: "vehicles",
    href: "/vehicles",
    label: "Vehicles",
    description: "Cars, bikes, service records, fuel/charging logs.",
    Icon: Car,
  },
  {
    slug: "trips",
    href: "/trips",
    label: "Trips",
    description: "Trips planned and past, itineraries, packing lists.",
    Icon: Plane,
  },
  {
    slug: "investments",
    href: "/investments",
    label: "Investments",
    description: "Holdings, watchlist, contribution history.",
    Icon: TrendingUp,
  },
  {
    slug: "inventory",
    href: "/inventory",
    label: "Inventory",
    description: "Stuff you own — what's where, what it cost, photos.",
    Icon: Package,
  },
  {
    slug: "media",
    href: "/media",
    label: "Media",
    description: "Books, films, shows, articles to read or remember.",
    Icon: BookOpen,
  },
  {
    slug: "places",
    href: "/places",
    label: "Places",
    description: "Restaurants, hotels, spots to come back to.",
    Icon: MapPin,
  },
  {
    slug: "best-practices",
    href: "/best-practices",
    label: "Best practices",
    description: "Personal playbooks, routines, things that worked.",
    Icon: Lightbulb,
  },
  {
    slug: "print-lists",
    href: "/print/today",
    label: "Print lists",
    description: "Single-page printable view of all your open todos.",
    Icon: Printer,
  },
];

export const STORAGE_KEY = "personalos:enabled-templates";
