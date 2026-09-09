/* A component imports the structural sheet it cannot draw without, so the sheet
   travels with it into every bundle that mounts it. The bundler turns that
   import into a stylesheet; the type system only needs to know it resolves. */
declare module "*.css";
