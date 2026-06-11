/**
 * Vite `?raw` import typing for the export feature (the project tsconfig does
 * not include vite/client types, and the contract keeps this declaration
 * inside features/export instead of a global declaration file).
 */
declare module "*.css?raw" {
  const content: string;
  export default content;
}
