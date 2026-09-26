// [vNext]: manipulate Metadata
// first creation of the file metadata

// [vNext]: manipulate Content
// first creation of the file content

// [COMMIT]: write in Slug in Content
// no data in slug and we insert new data
export const addSlugInContent = (content: string, slug: string): string => {
  const slugPlaceholder = '{{slug}}';
    return content.replace(slugPlaceholder, slug);
};

// [COMMIT]: replace Slug in Content
// there is existing data in slug and we replace it
export const replaceSlugInContent = (content: string, slug: string): string => {
  const slugPattern = /{{slug}}/g;
  return content.replace(slugPattern, slug);
};

// [COMMIT]: insert slug in Content
// there is existing data in slug and we to insert new data
export const insertSlugInContent = (content: string, slug: string): string => {
  const slugPattern = /{{slug}}/g;
  return content.replace(slugPattern, slug);
};