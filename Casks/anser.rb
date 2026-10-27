cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.34"
  sha256 arm:   "2a7eda4da50de2ad0e3934f36eb841fd98094d617198851ca0f94df7a44fa35e",
         intel: "b8e5e52bc01475e5106d404416fa0dd288523d5b76bd9f627bbc31c3873b4a52"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
