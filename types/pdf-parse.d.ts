declare module "pdf-parse" {
  type PDFParseResult = {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: any;
    metadata?: any;
    version?: string;
  };

  function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer
  ): Promise<PDFParseResult>;

  export = pdfParse;
}
