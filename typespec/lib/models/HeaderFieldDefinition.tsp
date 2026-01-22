import "../enums/HeaderFieldCategory.tsp";
import "../enums/HeaderFieldValueType.tsp";
import "../enums/HeaderFieldName.tsp";

namespace RemitImap;

@doc("Reference data defining RFC 2822 standard header fields and their constraints. Used for validation and parsing guidance.")
model HeaderFieldDefinition {
  @doc("Primary identifier")
  headerFieldDefinitionId: string;

  @doc("Canonical header field name (RFC 2822 standard or MIME)")
  fieldName: StandardHeaderField | MimeHeaderField;

  @doc("Category per RFC 2822 Section 3.6")
  fieldCategory: HeaderFieldCategory;

  @doc("True if structured field per RFC 2822 Section 2.2.2, false if unstructured")
  isStructured: boolean;

  @doc("Minimum required occurrences per RFC 2822 Section 3.6 (0 or 1)")
  @minValue(0)
  @maxValue(1)
  minOccurrences: int32;

  @doc("Maximum allowed occurrences (null = unlimited)")
  maxOccurrences?: int32;

  @doc("RFC 2822 section reference (e.g., '3.6.1')")
  rfcSection: string;

  @doc("Expected value type for parsing")
  valueType: HeaderFieldValueType;
}
