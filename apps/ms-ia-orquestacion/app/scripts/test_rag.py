from app.rag.reranker import rerank_cosine, should_reject_by_threshold
from app.rag.retriever import ChunkCandidate


def test_rerank_cosine_order() -> None:
    query = [1.0, 0.0, 0.0]
    candidates = [
        ChunkCandidate(
            chunk_id="a",
            source="s",
            version="v1",
            title="",
            chunk_index=0,
            text="uno",
            metadata={},
            mongo_score=0.65,
            embedding=[1.0, 0.0, 0.0],
            page_start=1,
            page_end=1,
        ),
        ChunkCandidate(
            chunk_id="b",
            source="s",
            version="v1",
            title="",
            chunk_index=1,
            text="dos",
            metadata={},
            mongo_score=0.8,
            embedding=[0.0, 1.0, 0.0],
            page_start=1,
            page_end=1,
        ),
    ]
    ranked = rerank_cosine(query, candidates)
    assert ranked[0].chunk_id == "a", "rerank_cosine no priorizo la similitud esperada"


def test_threshold_gate() -> None:
    assert should_reject_by_threshold(0.5, 0.72) is True
    assert should_reject_by_threshold(0.9, 0.72) is False


def main() -> None:
    test_rerank_cosine_order()
    test_threshold_gate()
    print("OK: test_rag passed")


if __name__ == "__main__":
    main()
