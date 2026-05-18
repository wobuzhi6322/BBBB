---
version: alpha
name: BBBB Broadcast Console
description: Public download and account site for BBBB Donation Signature.
colors:
  primary: "#10141F"
  secondary: "#586174"
  tertiary: "#1C7DF2"
  accent: "#FF4FD8"
  success: "#0A7A4B"
  warning: "#B7791F"
  danger: "#C2415D"
  neutral: "#F6F7F9"
  surface: "#FFFFFF"
  surface-muted: "#EEF2F6"
  border: "#D8DEE8"
  on-primary: "#FFFFFF"
  on-tertiary: "#FFFFFF"
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
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 24px
---

## Overview

BBBB Broadcast Console should feel like a product operations site rather than a decorative landing page. The first screen must immediately show the product name and the actual BBBB visual asset, while the surrounding interface should stay clear, structured, and trustworthy for streamers who need to download and run a Windows tool.

## Colors

The palette uses a light operational foundation with dark ink text and two controlled signal colors. Blue is the primary action color for download and account tasks. Magenta is used sparingly as a brand signal that connects to the BBBB logo. Green is reserved for system-ready states.

## Typography

Typography is dense and legible. Headlines are strong but not oversized inside operational panels. Labels are compact, uppercase, and used only for metadata or section category markers.

## Layout

Sections use full-width bands with constrained inner content. Cards are used for repeated feature, setup, and dashboard items only. The hero is not a split marketing card; it is a full-width product signal with the real BBBB image as the visual anchor and the download action in the same viewport.

## Elevation & Depth

Depth should be subtle. Use borders and small shadows to separate cards from the page, not glow-heavy effects. Download and login panels should read like reliable product controls.

## Shapes

Corners stay at 8px by default. Larger rounding is limited to the hero media frame and status pills.

## Components

Primary buttons use blue with white text. Secondary buttons use white surfaces with ink text. Status pills use neutral backgrounds with small colored dots.

## Do's and Don'ts

- Do keep the download path visually obvious.
- Do show version, file size, and Release status near the download button.
- Do keep login and dashboard surfaces calm and compact.
- Do not use decorative gradient blobs or abstract SVG backgrounds.
- Do not hide the product name behind only small navigation text.
- Do not create nested cards.
