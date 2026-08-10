// The only surface the worker calls. Hunspell's own C API answers suggestions
// through a `char***` the caller must walk and free; joining them here keeps
// that pointer arithmetic out of JavaScript, where getting it wrong is a leak
// nobody sees.
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "hunspell.hxx"

extern "C" {

Hunspell* remit_open(const char* affPath, const char* dicPath) {
	return new Hunspell(affPath, dicPath);
}

void remit_close(Hunspell* engine) { delete engine; }

int remit_spell(Hunspell* engine, const char* word) {
	return engine->spell(std::string(word)) ? 1 : 0;
}

int remit_add(Hunspell* engine, const char* word) {
	return engine->add(std::string(word));
}

char* remit_suggest(Hunspell* engine, const char* word) {
	const std::vector<std::string> found = engine->suggest(std::string(word));
	std::string joined;
	for (size_t at = 0; at < found.size(); ++at) {
		if (at > 0) joined += '\n';
		joined += found[at];
	}
	char* out = static_cast<char*>(std::malloc(joined.size() + 1));
	if (out == nullptr) return nullptr;
	std::memcpy(out, joined.c_str(), joined.size() + 1);
	return out;
}
}
