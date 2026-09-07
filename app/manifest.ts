import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Detergents Delivered",
    short_name: "DD",
    description:
      "Household detergents and everyday essentials, delivered locally.",
    start_url: "/",
    display: "standalone",
    background_color: "#F0FDFA",
    theme_color: "#0F766E",
    icons: [
      {
        src: "/brand/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
