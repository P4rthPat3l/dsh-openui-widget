/**
 * The OpenUI stylesheet is imported as text so it can be injected with the
 * widget. esbuild loads `.css` with the text loader; TypeScript needs the shape.
 */
declare module '@openuidev/react-ui/index.css' {
  const css: string
  export default css
}
