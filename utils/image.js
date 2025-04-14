export function getCategoryCounts(images) {
  const counts = {};
  for (const image of images) {
    counts[image.category] = (counts[image.category] || 0) + 1;
  }
  return counts;
}

export const getUserImagesGroupedByStage = async (images) => {
  // Group images by stage
  const grouped = images.reduce((acc, image) => {
    const stage = image.stage || 'unknown';
    if (!acc[stage]) {
      acc[stage] = [];
    }
    acc[stage].push(image);
    return acc;
  }, {});

  return grouped;
};
