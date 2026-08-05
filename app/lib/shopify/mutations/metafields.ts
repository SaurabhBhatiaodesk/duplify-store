export const METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
  mutation duplifyMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message }
    }
  }
`;

export interface MetafieldDefinitionInput {
  name: string;
  namespace: string;
  key: string;
  description?: string;
  type: string;
  ownerType: string;
}
