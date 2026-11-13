import type { MetadataRoute } from 'next';
import { SITE_URL } from './seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/features`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/worker`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
  ];
}
