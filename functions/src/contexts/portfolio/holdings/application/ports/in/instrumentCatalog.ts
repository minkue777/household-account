import type {
  CatalogPublicationState,
  PublishCatalogCommand,
  PublishCatalogResult,
  ReadCatalogQuery,
  ReadCatalogResult,
} from "../../../domain/model/instrumentCatalog";

export interface InstrumentCatalog {
  publish(command: PublishCatalogCommand): Promise<PublishCatalogResult>;
  read(query: ReadCatalogQuery): Promise<ReadCatalogResult>;
  publicationState(): Promise<CatalogPublicationState>;
}
