---
version: alpha
name: 계이득 Broadcast Console
description: Public download, account, and legal notice site for 계이득.
defaultMode: dark
colors:
  primary: "#F6F7F9"
  secondary: "#A8B3C7"
  tertiary: "#65D7FF"
  accent: "#FF4FD8"
  success: "#25C281"
  warning: "#F5C451"
  danger: "#FF6F91"
  neutral: "#080A10"
  surface: "#111722"
  surface-muted: "#192131"
  border: "#2A3446"
  on-primary: "#080A10"
  on-tertiary: "#071018"
  light-primary: "#10141F"
  light-secondary: "#586174"
  light-tertiary: "#1C7DF2"
  light-accent: "#D92BB8"
  light-success: "#0A7A4B"
  light-warning: "#B7791F"
  light-danger: "#C2415D"
  light-neutral: "#F6F7F9"
  light-surface: "#FFFFFF"
  light-surface-muted: "#EEF2F6"
  light-border: "#D8DEE8"
  light-on-primary: "#FFFFFF"
  light-on-tertiary: "#FFFFFF"
typography:
  h1:
    fontFamily: Inter
    fontSize: 4.5rem
    fontWeight: 900
    lineHeight: 0.96
    letterSpacing: "0"
  h2:
    fontFamily: Inter
    fontSize: 2.5rem
    fontWeight: 900
    lineHeight: 1.08
    letterSpacing: "0"
  h3:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.58
    letterSpacing: "0"
  label:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0"
rounded:
  sm: 6px
  md: 8px
  lg: 12px
spacing:
  xs: 6px
  sm: 10px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.md}"
    padding: 12px 18px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 12px 18px
  theme-toggle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 7px 11px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 24px
---

## Overview

계이득 Broadcast Console should feel like a product operations site rather than a decorative landing page. The first screen must immediately explain the user-facing value: bank deposit notifications become OBS signatures, wallpapers, and media output. Internal infrastructure names should stay out of public copy. The Korean name 계이득 should be the first-viewport brand signal.

## Colors

Dark mode is the default because the product is used around OBS and broadcast tooling, where a low-glare interface is more comfortable. The light palette is available for users who manage downloads and accounts in a normal browser context. Blue remains the primary action color for download and account tasks. Magenta is used sparingly as a brand signal. Green is reserved for system-ready states.

## Typography

Typography is dense and legible. Headlines are strong but not oversized inside operational panels. Labels are compact, uppercase, and used only for metadata or section category markers.

## Layout

Sections use full-width bands with constrained inner content. Cards are used for repeated feature, setup, and dashboard items only. The hero is not a split marketing card; it is a full-width product signal with the 계이득 name and the download action in the same viewport.

Legal pages use the same header, footer, theme toggle, and card rhythm as the main site. They should read as ordinary service footer pages and must not expose admin implementation details.

## Elevation & Depth

Depth should be subtle. Use borders and small shadows to separate cards from the page, not glow-heavy effects. Download and login panels should read like reliable product controls.

## Shapes

Corners stay at 8px by default. Larger rounding is limited to the hero media frame and status pills.

## Components

Primary buttons use the mode-specific blue token and should keep strong contrast in both themes. Secondary buttons use the current surface token. Status pills use current surface backgrounds with small green dots. The theme toggle is a compact header control and must persist the user's selected mode.

## Do's and Don'ts

- Do keep the download path visually obvious.
- Do show version, file size, and latest-file status near the download button.
- Do keep login and dashboard surfaces calm and compact.
- Do explain the product as bank deposit notification to OBS signature output.
- Do keep privacy, terms, and advertising/cookie notices in the footer.
- Do keep internal hosting, database, and deployment vendor names out of public copy.
- Do not use decorative gradient blobs or abstract SVG backgrounds.
- Do not hide the product name behind only small navigation text.
- Do not create nested cards.
