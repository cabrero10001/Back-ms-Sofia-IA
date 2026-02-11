"""
Interfaz abstracta para RAG + Reranker.
Fase 1: MockRAGProvider (sin funcionalidad real).
Fase 2: implementar con pgvector + embeddings + reranker.
"""
from abc import ABC, abstractmethod
from typing import Any


class RAGResult:
    def __init__(self, fragmento_id: str, contenido: str, score: float, metadata: dict | None = None):
        self.fragmento_id = fragmento_id
        self.contenido = contenido
        self.score = score
        self.metadata = metadata or {}


class RAGProvider(ABC):
    @abstractmethod
    async def query(self, texto: str, top_k: int = 5) -> list[RAGResult]:
        """Busca fragmentos relevantes dado un texto de consulta."""
        ...

    @abstractmethod
    async def rerank(self, query: str, results: list[RAGResult], top_k: int = 3) -> list[RAGResult]:
        """Re-rankea los resultados usando un modelo de reranking."""
        ...


class MockRAGProvider(RAGProvider):
    async def query(self, texto: str, top_k: int = 5) -> list[RAGResult]:
        """Mock: retorna lista vacía (sin documentos indexados aún)."""
        return []

    async def rerank(self, query: str, results: list[RAGResult], top_k: int = 3) -> list[RAGResult]:
        """Mock: retorna los mismos resultados sin re-rankear."""
        return results[:top_k]
