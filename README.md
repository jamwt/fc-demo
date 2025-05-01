# Few-shot chat based on sample dialog

No UI, just showing the Convex side working.

1. Reads a JSON file from Convex storage (which could be uploaded from the frontend.)
1. Creates embeddings out of the sample dialog.
1. Uses those embeddings to provide samples for a model to generate a response to
   user chat.
