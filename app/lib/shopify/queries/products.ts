// Bulk-operation query for reading a source store's full product catalog.
// `collections { edges { node { id } } }` only fetches the id — enough to
// record product->collection membership (used by the Collections stage,
// which runs after Products in the migration order) without duplicating full
// collection attributes across every product line of the bulk export.
export const BULK_PRODUCTS_QUERY = `
{
  products {
    edges {
      node {
        id
        title
        handle
        descriptionHtml
        productType
        vendor
        tags
        status
        templateSuffix
        seo { title description }
        options { name position values }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              compareAtPrice
              barcode
              position
              taxable
              inventoryPolicy
              selectedOptions { name value }
            }
          }
        }
        collections {
          edges { node { id } }
        }
      }
    }
  }
}`;

export const PRODUCTS_PAGE_QUERY = `#graphql
  query duplifyProductsPage($after: String) {
    products(first: 50, after: $after) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          productType
          vendor
          tags
          status
          templateSuffix
          seo { title description }
          options { name position values }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                barcode
                position
                taxable
                inventoryPolicy
                selectedOptions { name value }
              }
            }
          }
          collections(first: 100) {
            edges { node { id } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query duplifyProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      edges { node { id handle } }
    }
  }
`;
