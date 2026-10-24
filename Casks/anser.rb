cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.28"
  sha256 arm:   "1bcacf370a44010bf09bacc760ad2e253be7accb40ccd1dbe34bc1e1d95c280e",
         intel: "b940744fb425754a748d5b90c51e18b7795bbe50b8c05c7ce00c560fe0087fcd"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
